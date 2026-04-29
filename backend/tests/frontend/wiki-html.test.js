/**
 * FRONTEND TESTS — Atlas Wiki HTML
 * Tests: HTML structure, API endpoints, components, editor toolbar
 */
const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', '..', '..', 'frontend', 'build', 'wiki.html');
let html;

beforeAll(() => {
  html = fs.readFileSync(htmlPath, 'utf8');
});

describe('HTML Structure', () => {
  test('should have valid HTML structure', () => {
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  test('should have root div', () => {
    expect(html).toContain('id="root"');
  });

  test('should include React', () => {
    expect(html).toContain('react');
  });
});

describe('API Configuration', () => {
  test('should use dynamic API base URL', () => {
    expect(html).toContain("window.location.origin + '/api'");
  });

  test('should define wiki API methods', () => {
    const apiMethods = [
      'getSpaces', 'getSpace', 'getSpaceTree', 'getSpacePages',
      'getPage', 'savePage', 'createPage',
      'getRecentPages', 'getStarredPages',
      'getPageComments', 'addComment',
      'getPageVersions', 'search', 'createSpace',
    ];
    apiMethods.forEach(method => {
      expect(html).toContain(method);
    });
  });
});

describe('Component Definitions', () => {
  const requiredComponents = [
    'TopNav', 'Sidebar', 'Dashboard', 'SpaceView',
    'PageView', 'PageEditor', 'PageHistory',
    'SearchResults', 'CreateSpaceModal', 'App',
  ];

  requiredComponents.forEach(comp => {
    test(`should define ${comp} component`, () => {
      expect(html).toContain(`function ${comp}`);
    });
  });
});

describe('Icons', () => {
  const requiredIcons = [
    'confluence', 'search', 'page', 'plus', 'star',
    'edit', 'check', 'close', 'share', 'bold', 'italic',
    'underline', 'listBullet', 'listNumber', 'alignLeft',
    'link', 'image', 'table', 'mention', 'emoji', 'code',
    'hr', 'folder',
  ];

  requiredIcons.forEach(icon => {
    test(`should define ${icon} icon`, () => {
      expect(html).toContain(`${icon}:`);
    });
  });
});

describe('Editor Toolbar', () => {
  test('should have heading selector', () => {
    expect(html).toContain('Normal text');
    expect(html).toContain('Heading 1');
    expect(html).toContain('Heading 2');
    expect(html).toContain('Heading 3');
  });

  test('should support formatting commands', () => {
    expect(html).toContain("exec('bold')");
    expect(html).toContain("exec('italic')");
    expect(html).toContain("exec('underline')");
  });

  test('should support list commands', () => {
    expect(html).toContain("exec('insertUnorderedList')");
    expect(html).toContain("exec('insertOrderedList')");
  });

  test('should have link popup', () => {
    expect(html).toContain('insertLink');
    expect(html).toContain('createLink');
  });

  test('should have image insertion', () => {
    expect(html).toContain('insertImage');
  });

  test('should have table insertion with rows/cols', () => {
    expect(html).toContain('insertTable');
    expect(html).toContain('tableRows');
    expect(html).toContain('tableCols');
  });

  test('should have code block and inline code', () => {
    expect(html).toContain('insertCodeBlock');
    expect(html).toContain('insertInlineCode');
  });

  test('should have mention picker', () => {
    expect(html).toContain('insertMention');
    expect(html).toContain('mentionSearch');
  });

  test('should have emoji picker', () => {
    expect(html).toContain('insertEmoji');
    expect(html).toContain('EMOJIS');
  });

  test('should have alignment options', () => {
    expect(html).toContain('justifyLeft');
    expect(html).toContain('justifyCenter');
    expect(html).toContain('justifyRight');
  });

  test('should save/restore selection for popups', () => {
    expect(html).toContain('saveSelection');
    expect(html).toContain('restoreSelection');
  });
});

describe('Create Space Modal', () => {
  test('should have space creation form fields', () => {
    expect(html).toContain('Space name');
    expect(html).toContain('Space key');
  });

  test('Create button should use refreshSpaces callback', () => {
    expect(html).toContain('refreshSpaces');
  });
});

describe('Navigation', () => {
  test('should not have Templates or Apps nav buttons', () => {
    // Templates and Apps were removed per user request
    expect(html).not.toContain("onNavigate('templates')");
    // Check that Apps button is removed
    const hasAppsButton = html.includes("onClick={() => onNavigate('home')}>Apps</button>");
    expect(hasAppsButton).toBe(false);
  });

  test('should have Create dropdown with New page and New space', () => {
    expect(html).toContain('New page');
    expect(html).toContain('New space');
  });
});

describe('Auth Integration', () => {
  test('should read atlas_user from localStorage', () => {
    expect(html).toContain('atlas_user');
  });

  test('should show login prompt for unauthenticated users', () => {
    expect(html).toContain('Please log in to Atlas first');
  });
});
