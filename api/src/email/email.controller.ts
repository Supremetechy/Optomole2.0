import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EmailInboxConnectRequest, EmailService } from './email.service';

@ApiTags('email')
@Controller('email')
export class EmailController {
  constructor(private readonly email: EmailService) {}

  @Post('inbox/connect')
  connectInbox(@Body() body: EmailInboxConnectRequest) {
    return this.email.connectInbox(body);
  }
}
