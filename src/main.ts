process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { DataSource } from "typeorm";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.listen(3001);
  const ds = app.get(DataSource);

  console.log(
    "TypeORM entities loaded:",
    ds.entityMetadatas.map((m) => m.name),
  );
}

bootstrap();
