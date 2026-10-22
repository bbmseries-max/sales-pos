import { bootstrapApplication } from '@angular/platform-browser';
import * as Sentry from '@sentry/angular';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { isDevMode } from '@angular/core';

Sentry.init({
  dsn: 'https://7b7c18852774244b4d1833d9f713323a@o4512295315898368.ingest.de.sentry.io/4512295397163088',
  environment: isDevMode() ? 'development' : 'production',
  tracesSampleRate: 1.0,
});

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));