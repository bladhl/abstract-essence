import { Component } from '@angular/core';
import { OpenAIStream } from 'ai';
import OpenAI from 'openai/index.mjs';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css'
})
export class HomeComponent {
  test = 69;

}
