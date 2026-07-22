// JQL v2 tokenizer + recursive-descent parser.
//
// Grammar:
//   orExpr  := andExpr (OR andExpr)*
//   andExpr := unary (AND unary)*
//   unary   := NOT? primary
//   primary := '(' orExpr ')' | clause
//   clause  := field ('=' | '!=') value
//            | field NOT? IN '(' value (',' value)* ')'
//            | field IS NOT? EMPTY

class JqlSyntaxError extends Error {
  constructor(message, column) {
    super(`${message} at column ${column + 1}`);
    this.name = 'JqlSyntaxError';
    this.column = column;
  }
}

function tokenize(source) {
  const input = String(source || '');
  const tokens = [];
  let i = 0;

  while (i < input.length) {
    if (/\s/.test(input[i])) { i += 1; continue; }

    const start = i;
    const char = input[i];
    if (char === '(') { tokens.push({ type: 'LPAREN', value: char, start, end: ++i }); continue; }
    if (char === ')') { tokens.push({ type: 'RPAREN', value: char, start, end: ++i }); continue; }
    if (char === ',') { tokens.push({ type: 'COMMA', value: char, start, end: ++i }); continue; }
    if (char === '=') { tokens.push({ type: 'EQ', value: char, start, end: ++i }); continue; }
    if (char === '!') {
      if (input[i + 1] !== '=') throw new JqlSyntaxError('Expected "!="', start);
      i += 2;
      tokens.push({ type: 'NEQ', value: '!=', start, end: i });
      continue;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      i += 1;
      let value = '';
      let closed = false;
      while (i < input.length) {
        if (input[i] === '\\' && i + 1 < input.length) {
          value += input[i + 1];
          i += 2;
          continue;
        }
        if (input[i] === quote) {
          i += 1;
          closed = true;
          break;
        }
        value += input[i];
        i += 1;
      }
      if (!closed) throw new JqlSyntaxError('Unterminated quoted value', start);
      tokens.push({ type: 'STRING', value, start, end: i });
      continue;
    }

    while (i < input.length && !/[\s(),=!"']/.test(input[i])) i += 1;
    if (i === start) throw new JqlSyntaxError(`Unexpected token "${input[i]}"`, start);
    tokens.push({ type: 'WORD', value: input.slice(start, i), start, end: i });
  }

  tokens.push({ type: 'EOF', value: '', start: input.length, end: input.length });
  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.index = 0;
  }

  current() { return this.tokens[this.index]; }
  advance() { const token = this.current(); this.index += 1; return token; }
  keyword(word) {
    const token = this.current();
    return token.type === 'WORD' && token.value.toUpperCase() === word;
  }
  matchKeyword(word) {
    if (!this.keyword(word)) return null;
    return this.advance();
  }
  expect(type, message) {
    const token = this.current();
    if (token.type !== type) throw new JqlSyntaxError(message, token.start);
    return this.advance();
  }

  parse() {
    if (this.current().type === 'EOF') throw new JqlSyntaxError('Empty query', 0);
    const expression = this.parseOr();
    const tail = this.current();
    if (tail.type !== 'EOF') {
      throw new JqlSyntaxError(`Unexpected token "${tail.value}"`, tail.start);
    }
    return expression;
  }

  parseOr() {
    let node = this.parseAnd();
    while (this.matchKeyword('OR')) {
      const operator = this.tokens[this.index - 1];
      node = { type: 'binary', operator: 'OR', left: node, right: this.parseAnd(), column: operator.start };
    }
    return node;
  }

  parseAnd() {
    let node = this.parseUnary();
    while (this.matchKeyword('AND')) {
      const operator = this.tokens[this.index - 1];
      node = { type: 'binary', operator: 'AND', left: node, right: this.parseUnary(), column: operator.start };
    }
    return node;
  }

  parseUnary() {
    const not = this.matchKeyword('NOT');
    if (not) return { type: 'not', operand: this.parseUnary(), column: not.start };
    return this.parsePrimary();
  }

  parsePrimary() {
    const open = this.current();
    if (open.type !== 'LPAREN') return this.parseClause();
    this.advance();
    const expression = this.parseOr();
    this.expect('RPAREN', 'Expected ")"');
    return expression;
  }

  parseClause() {
    const field = this.expect('WORD', 'Expected a field name');
    let operator;

    if (this.current().type === 'EQ') { this.advance(); operator = '='; }
    else if (this.current().type === 'NEQ') { this.advance(); operator = '!='; }
    else if (this.matchKeyword('IN')) operator = 'IN';
    else if (this.matchKeyword('NOT')) {
      if (!this.matchKeyword('IN')) {
        throw new JqlSyntaxError('Expected IN after NOT', this.current().start);
      }
      operator = 'NOT IN';
    } else if (this.matchKeyword('IS')) {
      const negated = !!this.matchKeyword('NOT');
      if (!this.matchKeyword('EMPTY')) {
        throw new JqlSyntaxError('Expected EMPTY after IS', this.current().start);
      }
      operator = negated ? 'IS NOT EMPTY' : 'IS EMPTY';
    } else {
      throw new JqlSyntaxError(`Expected an operator after "${field.value}"`, this.current().start);
    }

    const node = {
      type: 'clause',
      field: field.value.toLowerCase(),
      fieldColumn: field.start,
      operator,
      values: [],
      column: field.start,
    };

    if (operator === 'IS EMPTY' || operator === 'IS NOT EMPTY') return node;
    if (operator === 'IN' || operator === 'NOT IN') {
      this.expect('LPAREN', `Expected "(" after ${operator}`);
      if (this.current().type === 'RPAREN') {
        throw new JqlSyntaxError('IN requires at least one value', this.current().start);
      }
      while (true) {
        node.values.push(this.parseValue(true));
        if (this.current().type !== 'COMMA') break;
        this.advance();
      }
      this.expect('RPAREN', 'Expected ")" after IN values');
      return node;
    }

    node.values.push(this.parseValue(false));
    return node;
  }

  parseValue(inList) {
    const first = this.current();
    if (first.type !== 'WORD' && first.type !== 'STRING') {
      throw new JqlSyntaxError('Expected a value', first.start);
    }
    this.advance();
    if (first.type === 'STRING') return { value: first.value, column: first.start };

    // JQL v1 accepted an unquoted display name such as `assignee = Priya
    // Patel`. Keep that compatibility while logical keywords still delimit a
    // comparison and commas/parentheses delimit an IN list.
    const parts = [first.value];
    while (this.current().type === 'WORD') {
      if (!inList && (this.keyword('AND') || this.keyword('OR'))) break;
      parts.push(this.advance().value);
    }
    return { value: parts.join(' '), column: first.start };
  }
}

function parseToAst(source) {
  try {
    return { ast: new Parser(tokenize(source)).parse() };
  } catch (error) {
    if (error instanceof JqlSyntaxError) return { error: error.message, column: error.column };
    throw error;
  }
}

module.exports = { tokenize, parseToAst, JqlSyntaxError };
