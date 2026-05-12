import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { SocketAdapter } from './sockets/socket.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Use custom Socket.IO adapter
  app.useWebSocketAdapter(new SocketAdapter(app));

  // Global prefix
  app.setGlobalPrefix('api/v1');

  // CORS
  app.enableCors({
    origin: '*',
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Swagger setup
  const config = new DocumentBuilder()
    .setTitle('NexChat API')
    .setDescription(
      'Real-time chat application REST API. Socket events are documented in SocketEvents.md.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearer',
    )
    .addTag('Auth', 'Authentication & token management')
    .addTag('Users', 'User profiles and search')
    .addTag('Friends', 'Friend system — requests, block/unblock')
    .addTag('Conversations', 'Direct and group conversations')
    .addTag('Messages', 'Message history (real-time via Socket)')
    .addTag('Notifications', 'Notification management')
    .addTag('Uploads', 'File uploads to Cloudinary')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
    },
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  console.log(`🚀 NexChat API running on: http://localhost:${port}/api/v1`);
  console.log(`📚 Swagger docs:           http://localhost:${port}/api/docs`);
  console.log(`🔌 Socket.IO:              ws://localhost:${port}`);
}

bootstrap();
