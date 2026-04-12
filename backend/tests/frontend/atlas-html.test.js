/**
 * FRONTEND TESTS — Atlas (Jira) HTML
 * Tests: HTML structure, API endpoint references, component definitions, routing
 */
const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', '..', '..', 'frontend', 'build', 'index.html');
let html;

beforeAll(() => {
  html = fs.readFileSync(htmlPath, 'utf8');
});

describe('HTML Structure', () => {
  test('should have valid HTML structure', () => {
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
    expect(html).toContain('<head>');
    expect(html).toContain('<body>');
  });

  test('should have root div for React', () => {
    expect(html).toContain('id="root"');
  });

  test('should include React and Babel', () => {
    expect(html).toContain('react');
    expect(html).toContain('babel');
  });

  test('should have text/babel script type', () => {
    expect(html).toContain('type="text/babel"');
  });
});

describe('API Configuration', () => {
  test('should use dynamic API base URL', () => {
    expect(html).toContain("window.location.origin+'/api'");
  });

  test('should not have hardcoded localhost in API calls', () => {
    // Only the const definition should reference origin
    const lines = html.split('\n');
    const apiCalls = lines.filter(l => l.includes('fetch(') && l.includes('localhost'));
    expect(apiCalls.length).toBe(0);
  });
});

describe('Component Definitions', () => {
  const requiredComponents = [
    'LoginPage', 'App', 'AppContent', 'Sidebar',
    'BoardView', 'BacklogView', 'SprintView',
    'IssueDetailModal', 'CreateIssueModal',
    'ProfileView', 'SettingsView',
    'DashboardView', 'ReportsView',
    'AdminDashboardView', 'AdminUsersView', 'AdminProjectsView',
    'AuditLogView',
  ];

  requiredComponents.forEach(comp => {
    test(`should define ${comp} component`, () => {
      expect(html).toContain(`function ${comp}`);
    });
  });
});

describe('URL Hash Routing', () => {
  test('should read from window.location.hash', () => {
    expect(html).toContain('window.location.hash');
  });

  test('should have valid views list', () => {
    const validViews = ['board', 'backlog', 'sprints', 'reports', 'dashboard', 'profile', 'settings'];
    validViews.forEach(view => {
      expect(html).toContain(`'${view}'`);
    });
  });

  test('should listen for hashchange events', () => {
    expect(html).toContain('hashchange');
  });

  test('should update hash on view change', () => {
    expect(html).toContain('window.location.hash=v');
  });
});

describe('Auth Integration', () => {
  test('should store user in localStorage', () => {
    expect(html).toContain('atlas_user');
    expect(html).toContain('localStorage');
  });

  test('should send auth headers', () => {
    expect(html).toContain('x-user-id');
    expect(html).toContain('x-user-role');
    expect(html).toContain('x-auth-token');
  });

  test('should have login form', () => {
    expect(html).toContain('auth/login');
  });
});

describe('View Mappings', () => {
  const viewMappings = [
    ['board', 'BoardView'],
    ['backlog', 'BacklogView'],
    ['sprints', 'SprintView'],
    ['profile', 'ProfileView'],
    ['settings', 'SettingsView'],
    ['admin-dashboard', 'AdminDashboardView'],
    ['admin-users', 'AdminUsersView'],
    ['admin-audit', 'AuditLogView'],
  ];

  viewMappings.forEach(([key, component]) => {
    test(`view '${key}' should map to ${component}`, () => {
      expect(html).toContain(key);
      expect(html).toContain(component);
    });
  });
});

describe('CSS', () => {
  test('should have CSS variables for theming', () => {
    expect(html).toContain('--bg:');
    expect(html).toContain('--text:');
    expect(html).toContain('--border:');
  });

  test('should have SVG size constraints', () => {
    expect(html).toContain('.detail-field-label svg');
  });
});

describe('Issue Types and Statuses', () => {
  test('should support all issue types', () => {
    ['story', 'task', 'bug', 'epic', 'subtask'].forEach(type => {
      expect(html).toContain(type);
    });
  });

  test('should support all statuses', () => {
    ['todo', 'in_progress', 'in_review', 'done'].forEach(status => {
      expect(html).toContain(status);
    });
  });

  test('should support all priorities', () => {
    ['highest', 'high', 'medium', 'low', 'lowest'].forEach(priority => {
      expect(html).toContain(priority);
    });
  });
});
