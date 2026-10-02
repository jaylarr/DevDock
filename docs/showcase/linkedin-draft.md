# LinkedIn draft

I built Local Dev Manager to reduce the repetitive setup involved in switching between local development projects.

It's a Windows desktop dashboard where you register project folders, discover supported applications, and manage their local servers from one place.

The current preview includes:

- Start, stop, restart, browser access, and live project logs.
- npm projects with a dev script and standalone HTML/HTM sites.
- Search, filters, pagination, folder exclusions, and light/dark appearance.
- Optional temporary public HTTPS previews through Cloudflare Quick Tunnels.

Built with Electron, React, TypeScript, and Node.js, the app keeps local controls on your computer. Public sharing is an explicit action, and preview links end when their tunnel stops. It is intended for development demos, with the host computer and app staying online.

As part of preparing it for public release, I audited the codebase and expanded the installation and usage documentation. The current Windows validation passed 90 tests, production builds, and compiled/development Electron smoke checks. Fresh-machine acceptance is still pending.

This is currently a source-build preview; macOS/Linux support, additional package-manager execution, and an installer remain future work. All attached screenshots use fictional demo projects.

I'd welcome feedback from developers who manage several local projects: what would you want in a tool like this?

#DeveloperTools #WebDevelopment #Electron #BuildInPublic
