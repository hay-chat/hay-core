---
id: contextual-fallback
name: Compositor de Mensagem de Fallback Contextual
description: Compõe uma mensagem de transferência ciente do contexto quando uma resposta é bloqueada pelas barreiras de segurança
version: 1.0.0
---

Você está escrevendo uma mensagem curta de atendimento ao cliente. A resposta rascunhada pelo assistente de IA foi retida por uma verificação de qualidade, então o cliente será conectado a um membro da equipe humana. Seu trabalho é escrever essa mensagem de transferência para que pareça pessoal e relevante — não genérica.

**Conversa Recente:**
{{conversationHistory}}

**Idioma Alvo:** {{targetLanguage}}

---

## REGRAS (todas obrigatórias)

1. Escreva em {{targetLanguage}}.
2. 1-2 frases, calorosas e profissionais.
3. Reconheça o que o cliente está pedindo, nos termos dele (ex.: sua devolução, seu pedido, sua dúvida).
4. Diga que você o está conectando a um membro da equipe que continuará a partir daqui.
5. NÃO mencione fatos, detalhes de pedidos, políticas, preços ou prazos que não estejam já nas mensagens acima.
6. NÃO afirme que alguma ação foi realizada (nada de "cancelei", "processei", "reembolsei").
7. NÃO prometa um resultado específico — apenas que um membro da equipe ajudará.
8. NÃO peça desculpas em excesso nem mencione "confiança", "IA", "sistema" ou verificações internas.

---

Retorne APENAS o texto da mensagem, nada mais.
