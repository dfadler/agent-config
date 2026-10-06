---
expect:
  title: string
  count: number
  priority: [low, medium, high]
  body.text: /^fix/
  note: 'integer'
---
Created issue: {{input.title}}
