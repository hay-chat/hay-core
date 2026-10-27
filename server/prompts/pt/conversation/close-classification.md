---
id: close-classification
name: Classificação de Encerramento de Conversa
description: No encerramento, decide se a IA resolveu a conversa (cobrança) e escreve uma revisão de qualidade (Insights)
version: 1.0.0
---

Você revisa uma conversa de atendimento ao cliente que acabou de terminar. "AI" é o agente de IA da loja, "Human agent" é uma pessoa da equipe da loja.

CONVERSA:
{{transcript}}

FATOS:

- Como terminou: {{closeReason}}
- Foi transferida para um humano em algum momento: {{handedOff}}
- Canal: {{channel}}

PARTE 1: RESULTADO. Responda apenas com base na transcrição.

- is_spam: true apenas para tráfego de robôs, propaganda, texto sem sentido, abuso ou mensagens de teste sem um cliente real por trás.
- had_real_request: true quando o cliente pediu algo real (uma pergunta, um problema, um pedido). Apenas cumprimentos, apenas "obrigado" ou um chat vazio são false.
- ai_resolved: true quando as respostas da própria IA responderam ao pedido ou concluíram o que foi pedido, e o cliente ficou com o que precisava. Um humano pode ter participado, mas só conte quando a IA fez o trabalho de resolver. False quando a IA só cumprimentou, devolveu perguntas, disse que não podia ajudar, deu uma resposta errada ou vazia, ou quando um atendente humano fez o trabalho de resolver. Quando o cliente simplesmente parou de responder, decida se a última resposta substancial da IA provavelmente deu a ele o que precisava.
- outcome_reason: uma frase curta explicando a decisão.

PARTE 2: REVISÃO DE QUALIDADE para o dono da loja. Escreva os campos de texto em português do Brasil.

- summary: uma ou duas frases sobre o que o cliente queria e como foi.
- polarity: "positive" (correu bem), "negative" (algo deu errado ou poderia ser melhor) ou "neutral".
- action_type: a mudança mais útil para o dono da loja, desta lista:
  playbook_edit (um playbook existente deve mudar), new_playbook (um fluxo recorrente não tem playbook), knowledge_edit (um documento de conhecimento está errado ou confuso), knowledge_add (falta conhecimento), setup (configuração: transferência para humano, ferramenta ausente, integração desativada, documentos contraditórios), policy_ambiguity (a política da loja não está clara), product_bug (o site ou produto da loja parece quebrado), ux_confusion (o cliente se confundiu com o site da loja), support_training (como a equipe lidou com uma transferência), none (nada a mudar).
- severity: "low", "medium" ou "high" (high = venda perdida, informação errada ou cliente irritado).
- confidence: de 0 a 1, o quanto você tem certeza desta revisão.
- relevance: de 0 a 100, o quanto isto merece a atenção do dono. Conversa genérica ou apenas sentimento vale pouco.
- root_cause: uma frase curta, ou uma string vazia.
- area: um tema de uma ou duas palavras, como "frete", "trocas", "tamanhos", "pagamento".
- snippet: um trecho literal curto (no máximo 300 caracteres) da conversa que melhor mostra a questão.
- paraphrase: a necessidade do cliente com suas palavras, em uma frase.

PRIVACIDADE: nunca inclua nomes, e-mails, telefones, endereços, números de pedido, códigos de rastreio ou qualquer outro dado pessoal em nenhum campo. Substitua por [redacted]. Não descreva o cliente como pessoa.

Responda com um objeto JSON contendo todos os campos acima.
