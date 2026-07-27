const { FIELDS } = require('./fields');

function placeholders(values) {
  return values.map(() => '?').join(', ');
}

function errorAt(message, column) {
  return { error: `${message} at column ${column + 1}`, column };
}

function compileColumn(def, clause) {
  if (clause.operator === 'IS EMPTY' || clause.operator === 'IS NOT EMPTY') {
    return {
      sql: `${def.column} IS ${clause.operator === 'IS NOT EMPTY' ? 'NOT ' : ''}NULL`,
      params: [],
    };
  }

  const values = clause.values.map(({ value }) => def.ci ? value.toLowerCase() : value);
  const column = def.ci ? `LOWER(${def.column})` : def.column;
  if (clause.operator === '=' || clause.operator === '!=') {
    return { sql: `${column} ${clause.operator} ?`, params: values };
  }
  return {
    sql: `${column} ${clause.operator} (${placeholders(values)})`,
    params: values,
  };
}

function compileClause(clause, context) {
  const def = FIELDS[clause.field];
  if (!def) {
    return errorAt(
      `Unknown field "${clause.field}". Try: ${Object.keys(FIELDS).join(', ')}`,
      clause.fieldColumn,
    );
  }

  if (def.values && !clause.operator.includes('EMPTY')) {
    const allowed = new Set(def.values.map((value) => value.toLowerCase()));
    const invalid = clause.values.find(({ value }) => !allowed.has(value.toLowerCase()));
    if (invalid) {
      return errorAt(
        `Invalid value "${invalid.value}" for "${clause.field}". Try: ${def.values.join(', ')}`,
        invalid.column,
      );
    }
  }

  try {
    return def.compile ? def.compile(clause, context) : compileColumn(def, clause);
  } catch (error) {
    return errorAt(error.message || 'Could not compile query', clause.column);
  }
}

function parenthesize(child, parentPrecedence) {
  return child.precedence < parentPrecedence ? `(${child.sql})` : child.sql;
}

function compileNode(node, context) {
  if (node.type === 'clause') {
    const result = compileClause(node, context);
    return result.error ? result : { ...result, precedence: 4 };
  }

  if (node.type === 'not') {
    const operand = compileNode(node.operand, context);
    if (operand.error) return operand;
    return { sql: `NOT (${operand.sql})`, params: operand.params, precedence: 3 };
  }

  const precedence = node.operator === 'AND' ? 2 : 1;
  const left = compileNode(node.left, context);
  if (left.error) return left;
  const right = compileNode(node.right, context);
  if (right.error) return right;
  return {
    sql: `${parenthesize(left, precedence)} ${node.operator} ${parenthesize(right, precedence)}`,
    params: [...left.params, ...right.params],
    precedence,
  };
}

function compileAst(ast, context = {}) {
  const result = compileNode(ast, context);
  if (result.error) return result;
  return { where: result.sql, params: result.params };
}

module.exports = { compileAst, compileClause };
