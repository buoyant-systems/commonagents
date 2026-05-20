import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Common Agents',
  tagline: 'The open specification for declarative AI agent manifests',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://commonagents.info',
  baseUrl: '/',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  headTags: [
    {
      tagName: 'meta',
      attributes: {
        property: 'og:type',
        content: 'website',
      },
    },
    {
      tagName: 'meta',
      attributes: {
        property: 'og:site_name',
        content: 'Common Agents',
      },
    },
    {
      tagName: 'meta',
      attributes: {
        name: 'twitter:card',
        content: 'summary_large_image',
      },
    },
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/',
          lastVersion: 'v1beta1',
          includeCurrentVersion: false,
          versions: {
            v1beta1: {
              label: 'v1beta1',
              path: '/',
              badge: false,
              banner: 'none',
            },
          },
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    metadata: [
      {
        name: 'description',
        content:
          'Common Agents is the open specification for declarative AI agent manifests. Define agents, tools, and schedules as simple YAML files — portable, auditable, and implementation-agnostic.',
      },
      {
        property: 'og:description',
        content:
          'The open specification for declarative AI agent manifests. Define agents, tools, and schedules as YAML — portable across any compliant runtime.',
      },
    ],
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    announcementBar: {
      id: 'aimixer-cta',
      content:
        'Want to try Common Agents? <a href="https://www.aimixer.com">aiMixer</a> is the reference implementation →',
      backgroundColor: 'var(--ca-accent-teal)',
      textColor: '#ffffff',
      isCloseable: true,
    },
    navbar: {
      title: 'Common Agents',
      logo: {
        alt: 'Common Agents Logo',
        src: 'img/logo.png',
      },
      items: [
        {
          type: 'docsVersionDropdown',
          position: 'left',
        },
        {
          href: 'https://www.aimixer.com',
          label: 'aiMixer',
          position: 'right',
        },
        {
          href: 'https://github.com/buoyant-systems/commonagents',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Specification',
          items: [
            {
              label: 'Introduction',
              to: '/',
            },
            {
              label: 'Concepts',
              to: '/concepts',
            },
            {
              label: 'Agent Manifest',
              to: '/resources/agent',
            },
            {
              label: 'Tool Manifest',
              to: '/resources/tool',
            },
            {
              label: 'Tool Runtimes',
              to: '/resources/tool-runtimes',
            },
          ],
        },
        {
          title: 'Task Lifecycle',
          items: [
            {
              label: 'Task Context',
              to: '/capabilities/task-context',
            },
            {
              label: 'Middleware',
              to: '/capabilities/middleware',
            },
            {
              label: 'Bindings',
              to: '/capabilities/bindings',
            },
          ],
        },
        {
          title: 'Reference',
          items: [
            {
              label: 'CEL Reference',
              to: '/reference/cel',
            },
            {
              label: 'Parameter Pipeline',
              to: '/reference/parameters',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'aiMixer — Reference Implementation',
              href: 'https://www.aimixer.com',
            },
            {
              label: 'Buoyant Systems',
              href: 'https://www.buoyant.systems',
            },
          ],
        },
      ],
      copyright: `Common Agent Specification © ${new Date().getFullYear()} Buoyant Systems — licensed under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['yaml', 'bash', 'json'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
