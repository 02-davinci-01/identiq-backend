process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import cookieParser from "cookie-parser";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { DataSource } from "typeorm";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: true,
    credentials: true,
  });
  app.use(cookieParser());

  await app.listen(3001);

  const ds = app.get(DataSource);
  console.log(
    "TypeORM entities loaded:",
    ds.entityMetadatas.map((m) => m.name),
  );
}

bootstrap();
