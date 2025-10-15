import { Module, Global } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BrevoService } from "./brevo.service";

@Global()
@Module({
  providers: [
    {
      provide: BrevoService,
      useFactory: (config: ConfigService) => {
        // Use the dev mock when NODE_ENV=development OR no API key present
        const apiKey = config.get<string>("BREVO_API_KEY");

        return new BrevoService(config);
      },
      inject: [ConfigService],
    },
  ],
  exports: [BrevoService],
})
export class BrevoModule {}
