import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { marketDb } from './app/core/db/market-db';

(window as any).marketDb = marketDb;

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));