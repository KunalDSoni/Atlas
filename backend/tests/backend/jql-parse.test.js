const { parseToAst, tokenize } = require('../../utils/jql');

describe('JQL v2 tokenizer and parser', () => {
  test('AND binds tighter than OR', () => {
    const { ast } = parseToAst('status = todo OR type = bug AND priority = high');
    expect(ast.operator).toBe('OR');
    expect(ast.left.field).toBe('status');
    expect(ast.right.operator).toBe('AND');
  });

  test('parentheses override precedence', () => {
    const { ast } = parseToAst('(status = todo OR type = bug) AND priority = high');
    expect(ast.operator).toBe('AND');
    expect(ast.left.operator).toBe('OR');
  });

  test('parses NOT, IN, NOT IN and emptiness operators case-insensitively', () => {
    const { ast } = parseToAst(
      'NOT assignee IS EMPTY OR priority not in (low, lowest) AND reporter IS NOT EMPTY',
    );
    expect(ast.left.type).toBe('not');
    expect(ast.left.operand.operator).toBe('IS EMPTY');
    expect(ast.right.left.operator).toBe('NOT IN');
    expect(ast.right.left.values.map((v) => v.value)).toEqual(['low', 'lowest']);
    expect(ast.right.right.operator).toBe('IS NOT EMPTY');
  });

  test('keeps quoted values and v1 unquoted display names intact', () => {
    expect(parseToAst('request_type = "Hardware problem"').ast.values[0].value)
      .toBe('Hardware problem');
    expect(parseToAst('assignee = Priya Patel').ast.values[0].value).toBe('Priya Patel');
    expect(parseToAst("assignee = 'O\\'Brien'").ast.values[0].value).toBe("O'Brien");
  });

  test('reports useful one-based columns for syntax errors', () => {
    const source = 'status = todo AND (type = bug';
    const result = parseToAst(source);
    expect(result.column).toBe(source.length);
    expect(result.error).toContain(`column ${source.length + 1}`);

    const quote = parseToAst('status = "unfinished');
    expect(quote.error).toMatch(/Unterminated quoted value at column 10/);
  });

  test('the tokenizer records source offsets', () => {
    const tokens = tokenize('sla = breached');
    expect(tokens.slice(0, 3)).toEqual([
      expect.objectContaining({ type: 'WORD', value: 'sla', start: 0 }),
      expect.objectContaining({ type: 'EQ', start: 4 }),
      expect.objectContaining({ type: 'WORD', value: 'breached', start: 6 }),
    ]);
  });
});
