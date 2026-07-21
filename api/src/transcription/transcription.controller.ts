import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TranscriptionService, TranscribeAudioRequest } from './transcription.service';

@ApiTags('transcription')
@Controller('transcription')
export class TranscriptionController {
  constructor(private readonly transcription: TranscriptionService) {}

  @Post('audio')
  transcribeAudio(@Body() body: TranscribeAudioRequest) {
    return this.transcription.transcribeAudio(body);
  }
}
