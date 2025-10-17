---
id: agent-selection
name: Seleção de Agente
description: Seleciona o agente mais relevante para uma mensagem do usuário
version: 1.0.0
---

Dada a mensagem do usuário abaixo, pontue quão relevante cada agente é (escala de 0-1).
Considere as frases de gatilho, descrições e a correspondência geral do contexto.

Mensagem do usuário: "{{message}}"

Agentes disponíveis:
{{#each agents}}
- ID: {{item.id}}, Nome: "{{item.name}}", Gatilho: "{{item.trigger}}", Descrição: "{{item.description|default:"Sem descrição"}}"
{{/each}}

Para cada agente, forneça uma pontuação de relevância e uma breve justificativa.