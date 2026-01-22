import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CpcValidationService } from './cpc-validation.service';
import { LoggerModule } from '../logger/logger.module';

@Global()
@Module({
    imports: [ConfigModule, LoggerModule],
    providers: [CpcValidationService],
    exports: [CpcValidationService],
})
export class CpcValidationModule { }
