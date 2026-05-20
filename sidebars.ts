import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  specSidebar: [
    'intro',
    'why',
    'concepts',
    {
      type: 'category',
      label: 'Resource Manifests',
      collapsed: false,
      items: [
        'resources/agent',
        'resources/tool',
        'resources/tool-runtimes',
        'resources/bundle',
        'resources/schedule',
      ],
    },
    {
      type: 'category',
      label: 'Task Lifecycle',
      collapsed: false,
      items: [
        'capabilities/task-context',
        'capabilities/middleware',
        'capabilities/bindings',
      ],
    },
    'glossary',
    {
      type: 'category',
      label: 'Reference',
      collapsed: false,
      items: [
        'reference/cel',
        'reference/parameters',
      ],
    },
  ],
};

export default sidebars;
