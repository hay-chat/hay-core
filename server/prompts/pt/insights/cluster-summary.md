---
id: cluster-summary
name: Resumo de Grupo de Insights
description: Dá nome a um grupo de eventos de qualidade parecidos do Insights para o dono da loja (título, resumo, hipótese)
version: 1.0.0
---

O agente de IA da loja conversa com clientes. Depois de cada conversa, e de cada avaliação da equipe sobre uma resposta da IA, é escrita uma nota curta de qualidade. As notas abaixo foram agrupadas porque descrevem o mesmo padrão. Descreva o padrão para o dono da loja. Escreva todos os campos de texto em português do Brasil.

POLARIDADE: {{polarity}}
TIPO DE AÇÃO SUGERIDO: {{actionType}}
{{#if area}}
TEMA: {{area}}
{{/if}}
NOTAS NO GRUPO: {{count}} (segue uma amostra)

{{issues}}

Preencha:

- title: no máximo 8 palavras, nomeando o padrão de forma direta, como "Clientes não encontram o endereço de devolução" ou "Respostas claras sobre prazo de entrega". Sem aspas, sem ponto final.
- summary: duas frases sobre o que continua acontecendo, escritas para um dono de loja ocupado.
- hypothesis: uma ou duas frases sobre a causa mais provável e o que mudar. Para um padrão positivo, o que está funcionando e deve ser mantido.

Use apenas o que as notas dizem; não invente números, produtos ou políticas.

PRIVACIDADE: nunca inclua nomes, e-mails, telefones, endereços, números de pedido, códigos de rastreio ou qualquer outro dado pessoal. Substitua-os por [redacted]. Não descreva nenhum cliente ou membro da equipe como pessoa.

Responda com um objeto JSON contendo todos os campos acima.
