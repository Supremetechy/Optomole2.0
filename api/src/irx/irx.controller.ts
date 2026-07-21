import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IrxService, NormalizeIrxRequest } from './irx.service';

@ApiTags('irx')
@Controller('irx')
export class IrxController {
  constructor(private readonly irx: IrxService) {}

  @Post('normalize')
  normalize(@Body() body: NormalizeIrxRequest) {
    return this.irx.normalize(body);
  }
}
