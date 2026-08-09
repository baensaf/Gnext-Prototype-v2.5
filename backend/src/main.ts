import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';
import * as cookieParser from 'cookie-parser';
import * as express from 'express';
import * as path from 'path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: true,
    credentials: true,
  });

  app.use(cookieParser());
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
  app.useGlobalFilters(new ProblemDetailsFilter());

  const port = process.env.PORT || 3100;
  await app.listen(port);
  console.log(`Gnext Backend Monolith listening on port ${port}`);
}

bootstrap();
