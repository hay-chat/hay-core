---
id: user-closure-message
name: Mensagem de Encerramento Iniciada pelo Usuário
description: Gera uma mensagem de encerramento quando o usuário indica que deseja finalizar a conversa
version: 1.0.0
---

O cliente indicou que deseja encerrar a conversa e está {{satisfactionStatus}}.
Gere uma mensagem breve e natural de encerramento (1-2 frases) que reconheça contextualmente o que foi discutido e informe que a conversa foi encerrada e que pode escrever de novo quando quiser. Não diga que o problema foi resolvido, a menos que o cliente tenha dito isso.
Não use frases genéricas. Seja específico ao contexto da conversa. Retorne apenas o texto da mensagem, nada mais.
