import { createOpenAI, OpenAIProvider } from '@ai-sdk/openai';
import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { generateObject } from 'ai';
import OpenAI from 'openai/index.mjs';
import { isValid, z } from 'zod';
import { OPEN_AI_API_KEY } from '../../../../core/constants/general.constants';
import { ResponseObject } from '../../models/gpt-response.model';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css',
})
export class HomeComponent {
  // completion: ResponseObject = { abstractType: '', isValid: false, errorMessage: '', sections: [] };
  completion: ResponseObject = {
    isValid: true,
    errorMessage: '',
    abstractType: 'informative',
    sections: [
      {
        sectionName: 'context or background',
        text: 'We provide a new quantum algorithm that efficiently determines the quality of a least-squares fit over an exponentially large data set by building upon an algorithm for solving systems of linear equations efficiently [Harrow et al., Phys. Rev. Lett. 103, 150502 (2009)].',
        uuid: 'f1e1167e-0c0d-47d2-bb31-3c2b5a1f1e11',
      },
      {
        sectionName: 'aim or purpose of the research',
        text: 'In many cases, our algorithm can also efficiently find a concise function that approximates the data to be fitted and bound the approximation error.',
        uuid: 'aca0d5b9-9be7-4d2f-b8f7-fb6f7bdcfe8b',
      },
      {
        sectionName: 'significance or implications',
        text: 'In cases where the input data are pure quantum states, the algorithm can be used to provide an efficient parametric estimation of the quantum state and therefore can be applied as an alternative to full quantum-state tomography given a fault tolerant quantum computer.',
        uuid: 'e7e0b07c-5e01-4b72-8a3a-efc8c2ec3b48',
      },
    ],
  };

  model;
  openai: OpenAIProvider;
  mainForm: FormGroup;

  constructor(private fb: FormBuilder) {
    this.model = [
      { label: 'gpt-4o', value: 'gpt-4o' },
      { label: 'gpt-4o-mini', value: 'gpt-4o-mini' },
    ];
    this.mainForm = this.fb.group({
      abstractIn: [''],
      language: [0],
      api_key: [''],
    });

    this.openai = createOpenAI({
      apiKey: OPEN_AI_API_KEY,
    });
  }

  client = new OpenAI({ apiKey: OPEN_AI_API_KEY, dangerouslyAllowBrowser: true });

  async getCompletion() {
    // const completion = await this.client.chat.completions.create({
    //   messages: [{ role: 'user', content: 'Hi who are you?' }],
    //   model: 'gpt-4o-mini',
    //   stream: true,
    // });

    const { object } = await generateObject({
      model: this.openai(this.model[0].value),
      temperature: 0.69,
      schema: z.object({
        isValid: z.boolean(),
        errorMessage: z.string(),
        abstractType: z.string(),
        sections: z.array(
          z.object({
            sectionName: z.string(),
            text: z.string(),
            uuid: z.string(),
          })
        ),
      }),
      messages: [
        {
          role: 'system',
          content: `You will receive an abstract of the research paper enclosed in triple quotes. Kindly ensure that the provided text qualifies as an abstract. If it does not meet the criteria, please return the message specifying why it is not considered a valid abstract.
          Typically, an abstract encompasses the following sections: context or background, statement of the problem, aim or purpose of the research, methods used, results, significance or implications, and conclusions.
          Your task is to identify which of these typical sections are included in the provided abstract. Please be aware that not every abstract will contain all the sections mentioned above. Additionally, please determine the type of abstract it is.
          `,
        },
        {
          role: 'user',
          content: `"""${this.mainForm.get('abstractIn')?.value}"""`,
          // content: `The growing economic resemblance of spouses has contributed to rising inequality by increasing the number of couples in which there are two high- or two low-earning partners. The dominant explanation for this trend is increased assortative mating. Previous research has primarily relied on cross-sectional data and thus has been unable to disentangle changes in assortative mating from changes in the division of spouses’ paid labor—a potentially key mechanism given the dramatic rise in wives’ labor supply. We use data from the Panel Study of Income Dynamics (PSID) to decompose the increase in the correlation between spouses’ earnings and its contribution to inequality between 1970 and 2013 into parts due to (a) changes in assortative mating, and (b) changes in the division of paid labor. Contrary to what has often been assumed, the rise of economic homogamy and its contribution to inequality is largely attributable to changes in the division of paid labor rather than changes in sorting on earnings or earnings potential. Our findings indicate that the rise of economic homogamy cannot be explained by hypotheses centered on meeting and matching opportunities, and they show where in this process inequality is generated and where it is not.`,
        },
      ],
    });

    this.completion = object;
  }
}
