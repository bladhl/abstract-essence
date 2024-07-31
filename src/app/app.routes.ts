import { Routes } from '@angular/router';

export const routes: Routes = [
	{
		path: "",
		loadComponent: () => import("./features/home/pages/home/home.component").then((c) => c.HomeComponent)
	}
];
