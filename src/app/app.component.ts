import { Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Firestore } from '@angular/fire/firestore';
import { bootstrapTenantDocuments } from './core/utils/tenant-bootstrap.util';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  private firestore = inject(Firestore);
  title = 'maranth-pos-hub';

ngOnInit(): void {
    // Expose the helper globally in dev mode
    (window as any).seedTenants = async () => {
      console.log('Starting tenant bootstrap...');
      const total = await bootstrapTenantDocuments(this.firestore);
      console.log(`Successfully bootstrapped ${total} tenants into Firestore!`);
      alert(`Bootstrapped ${total} tenants into /tenants/{shopSlug} successfully!`);
    };
  }

}