 
import {
  // BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AiDiscoveryService } from '../ai-discovery/ai-discovery.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
// import type { StringValue } from 'ms'; // add this import

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private aiDiscoveryService: AiDiscoveryService,
  ) {}

  async register(dto: RegisterDto) {
    const existingEmail = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existingEmail) {
      throw new ConflictException('Email already in use');
    }

    const existingUsername = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (existingUsername) {
      throw new ConflictException('Username already taken');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 12);

    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        username: dto.username,
        email: dto.email,
        password: hashedPassword,
      },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        avatar: true,
        bio: true,
        createdAt: true,
        role: true,
      },
    });

    // Generate profile embedding in background so the new user is
    // discoverable in AI search right away (don't block registration)
    this.aiDiscoveryService.updateUserEmbedding(user.id).catch(console.error);

    const tokens = await this.generateTokens({
      sub: user.id,
      email: user.email,
    });

    await this.storeRefreshToken(user.id, tokens.refreshToken);

    return { user, ...tokens };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.generateTokens({
      sub: user.id,
      email: user.email,
    });

    await this.storeRefreshToken(user.id, tokens.refreshToken);

    const { password: _pw, ...safeUser } = user;
    return { user: safeUser, ...tokens };
  }

  async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      await this.prisma.refreshToken
        .delete({ where: { token: refreshToken } })
        .catch(() => null);
    } else {
      // Delete all refresh tokens for this user
      await this.prisma.refreshToken.deleteMany({ where: { userId } });
    }
    return { message: 'Logged out successfully' };
  }

  async refreshTokens(userId: string, email: string, tokenId: string) {
    // Delete the old token (rotate)
    await this.prisma.refreshToken
      .delete({ where: { id: tokenId } })
      .catch(() => null);

    const tokens = await this.generateTokens({ sub: userId, email });
    await this.storeRefreshToken(userId, tokens.refreshToken);

    return tokens;
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Return success even if user not found to prevent email enumeration
      return { message: 'If that email exists, a reset link has been sent.' };
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetPasswordExpires = new Date(Date.now() + 3600000); // 1 hour

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: resetToken,
        resetPasswordExpires,
      },
    });

    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/reset-password?token=${resetToken}`;

    // Fire-and-forget: don't block the response waiting for email delivery
    this.sendResetEmail(user.email, resetUrl).catch((error) => {
      console.error('Error sending reset email:', error);
    });

    return { message: 'If that email exists, a reset link has been sent.' };
  }

  async resetPassword(token: string, newPassword: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        resetPasswordToken: token,
        resetPasswordExpires: {
          gt: new Date(),
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Password reset token is invalid or has expired.');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetPasswordToken: null,
        resetPasswordExpires: null,
      },
    });

    // Optionally revoke all refresh tokens so other sessions are logged out
    await this.prisma.refreshToken.deleteMany({ where: { userId: user.id } });

    return { message: 'Password has been successfully reset.' };
  }

  private async sendResetEmail(to: string, resetUrl: string) {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY ?? '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'LinkUp Support', email: process.env.EMAIL_FROM },
        to: [{ email: to }],
        subject: 'Password Reset Request',
        htmlContent: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Password Reset Request</h2>
            <p>You requested a password reset. Please click the button below to set a new password:</p>
            <a href="${resetUrl}" style="display: inline-block; padding: 10px 20px; background-color: #8b5cf6; color: white; text-decoration: none; border-radius: 5px; margin-top: 10px;">Reset Password</a>
            <p style="margin-top: 20px; color: #666; font-size: 14px;">If you did not request this, you can safely ignore this email.</p>
          </div>
        `,
      }),
    });

    if (!response.ok) {
      throw new Error(`Brevo API error ${response.status}: ${await response.text()}`);
    }
  }

  private async generateTokens(payload: JwtPayload) {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: process.env.JWT_ACCESS_SECRET,
        expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN ?? '15m') as any,
      }),
      this.jwtService.signAsync(payload, {
        secret: process.env.JWT_REFRESH_SECRET,
        expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ?? '7d') as any,
      }),
    ]);
    return { accessToken, refreshToken };
  }

  private async storeRefreshToken(userId: string, token: string) {
    const refreshExpiresIn = process.env.JWT_REFRESH_EXPIRES_IN ?? '90d';
    const days = parseInt(refreshExpiresIn, 10) || 90;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

    await this.prisma.refreshToken.create({
      data: { userId, token, expiresAt },
    });
  }
}
