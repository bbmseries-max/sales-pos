import { ErrorHandler, Injectable } from '@angular/core';
import * as Sentry from '@sentry/angular';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  handleError(error: unknown): void {
    const errorString = (error instanceof Error ? error.stack || error.message : String(error)).toLowerCase();

    // Check for critical runtime patterns that break the UI or data layer
    const isCritical = 
      errorString.includes('chunkloaderror') ||         // App failed to load a module
      errorString.includes('indexeddb') ||              // POS local database failure
      errorString.includes('out of memory') ||
      errorString.includes('typeerror: cannot read');   // Common fatal null pointer

    Sentry.withScope((scope) => {
      if (isCritical) {
        scope.setLevel('fatal');
        scope.setTag('severity', 'p0');
      } else {
        scope.setLevel('error');
        scope.setTag('severity', 'normal');
      }

      Sentry.captureException(error);
    });

    // Still log to the developer console for local debugging
    console.error(error);
  }
}