import { createOpenAI } from '@ai-sdk/openai';
import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { generateObject } from 'ai';
import OpenAI from 'openai/index.mjs';
import { z } from 'zod';
import { OPEN_AI_API_KEY } from '../../../../core/constants/general.constants';
import { TestObject } from '../../models/test.model';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css',
})
export class HomeComponent {
  test: TestObject = { title: '', text: '' };
  openai = createOpenAI({
    apiKey: OPEN_AI_API_KEY,
  });

  client = new OpenAI({ apiKey: OPEN_AI_API_KEY, dangerouslyAllowBrowser: true });

  async getCompletion() {
    // const completion = await this.client.chat.completions.create({
    //   messages: [{ role: 'user', content: 'Hi who are you?' }],
    //   model: 'gpt-4o-mini',
    //   stream: true,
    // });

    const { object } = await generateObject({
      model: this.openai('gpt-4o-mini'),
      schema: z.object({
        title: z.string(),
        text: z.string(),
      }),
      prompt: 'Generate short story about love',
    });

    this.test = object;
  }
}
