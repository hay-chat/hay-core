---
id: handoff-summary
name: Resumo de Encaminhamento da Conversa
description: Gera um resumo curto para um agente humano assumir uma conversa
version: 1.1.0
---

Você está escrevendo um briefing para um agente de suporte humano que vai assumir uma conversa de um assistente de IA. Resuma em 2-4 frases curtas:

1. O que o cliente quer ou está perguntando
2. O que o assistente de IA já tentou ou respondeu
3. Por que a conversa foi encaminhada (se estiver claro)
4. Quais arquivos o cliente enviou, quando a conversa listar algum (aparecem como [Attachments: ...]), para o agente saber que deve abri-los

Escreva em linguagem simples, no tempo presente, sem preâmbulo. Retorne apenas o texto do resumo.

Conversa:

{{conversationContext}}
