import { NestFactory } from '@nestjs/core';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';
import * as cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:3030',
    'http://localhost:3000',
    'http://127.0.0.1:3030',
  ];

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  });

  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: (errors) => {
        const fieldErrors = errors.map((err) => ({
          field: err.property,
          code: 'INVALID_FIELD',
          message: Object.values(err.constraints || {}).join(', '),
        }));
        return new BadRequestException({
          code: 'VALIDATION_FAILED',
          title: 'Validation Error',
          detail: 'Validation failed for one or more fields.',
          fieldErrors,
        });
      },
    }),
  );
  app.useGlobalFilters(new ProblemDetailsFilter());

  const port = process.env.PORT || 3100;
  await app.listen(port);
  console.log(`Gnext Backend Monolith listening on port ${port}`);
}

bootstrap();
