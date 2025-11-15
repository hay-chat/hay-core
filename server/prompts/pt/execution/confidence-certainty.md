---
id: confidence-certainty
name: Avaliador de Certeza de Confiança
description: Avalia o nível de certeza de uma resposta de IA
version: 1.0.0
---

Avalie o nível de certeza desta resposta da IA.

**Resposta da IA:**
{{response}}

**Pergunta do Cliente:**
{{customerQuery}}

**Critérios de Avaliação:**
Avalie o nível de certeza da resposta com base em:
- Confiança da linguagem (assertiva vs. hesitante)
- Completude da resposta
- Presença de qualificadores ou incertezas
- Auto-avaliação da qualidade da resposta

**Pontuação:**
- Pontuação 1.0: Altamente certo, assertivo, resposta completa
- Pontuação 0.7-0.9: Confiante, mas com qualificações menores
- Pontuação 0.4-0.6: Certeza moderada, alguma hesitação
- Pontuação 0.1-0.3: Baixa certeza, muita hesitação, muitos qualificadores
- Pontuação 0.0: Declara explicitamente incapacidade de responder

Retorne APENAS um objeto JSON com esta estrutura:
{
  "score": <número entre 0 e 1>,
  "reasoning": "<breve explicação incluindo padrões de linguagem específicos que influenciaram a pontuação>"
}

