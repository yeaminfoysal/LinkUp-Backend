import { Injectable, BadRequestException } from '@nestjs/common';
import { configureCloudinary, cloudinary } from '../config/cloudinary.config';
import { UploadApiResponse } from 'cloudinary';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_AUDIO_SIZE = 20 * 1024 * 1024; // 20MB

const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/ogg'];
const ALLOWED_AUDIO_TYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
];
const ALLOWED_FILE_TYPES = ['application/pdf', 'text/plain'];

@Injectable()
export class UploadsService {
  constructor() {
    configureCloudinary();
  }

  async uploadFile(
    file: Express.Multer.File,
    folder = 'nexchat',
  ): Promise<{
    mediaUrl: string;
    publicId: string;
    format: string;
    bytes: number;
  }> {
    const mediaType = file.mimetype;

    // Validate size
    if (ALLOWED_IMAGE_TYPES.includes(mediaType) && file.size > MAX_IMAGE_SIZE) {
      throw new BadRequestException('Image file size must not exceed 5MB');
    }
    if (ALLOWED_VIDEO_TYPES.includes(mediaType) && file.size > MAX_VIDEO_SIZE) {
      throw new BadRequestException('Video file size must not exceed 50MB');
    }
    if (ALLOWED_AUDIO_TYPES.includes(mediaType) && file.size > MAX_AUDIO_SIZE) {
      throw new BadRequestException('Audio file size must not exceed 20MB');
    }

    const isAllowed = [
      ...ALLOWED_IMAGE_TYPES,
      ...ALLOWED_VIDEO_TYPES,
      ...ALLOWED_AUDIO_TYPES,
      ...ALLOWED_FILE_TYPES,
    ].includes(mediaType);

    if (!isAllowed) {
      throw new BadRequestException(`Unsupported file type: ${mediaType}`);
    }

    const resourceType = ALLOWED_VIDEO_TYPES.includes(mediaType)
      ? 'video'
      : ALLOWED_AUDIO_TYPES.includes(mediaType)
        ? 'video' // Cloudinary uses 'video' for audio too
        : 'image';

    return new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          { folder, resource_type: resourceType as 'image' | 'video' | 'raw' },
          (error, result) => {
            if (error || !result) {
              reject(
                new BadRequestException(error?.message ?? 'Upload failed'),
              );
              return;
            }
            const res = result as UploadApiResponse;
            resolve({
              mediaUrl: res.secure_url,
              publicId: res.public_id,
              format: res.format,
              bytes: res.bytes,
            });
          },
        )
        .end(file.buffer);
    });
  }

  async uploadMultipleFiles(
    files: Express.Multer.File[],
    folder = 'nexchat',
  ): Promise<
    { mediaUrl: string; publicId: string; format: string; bytes: number }[]
  > {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files provided');
    }

    // Upload all files concurrently
    const uploadPromises = files.map((file) => this.uploadFile(file, folder));
    return Promise.all(uploadPromises);
  }
}
