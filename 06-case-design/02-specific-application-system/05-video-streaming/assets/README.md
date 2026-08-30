# Video Streaming architecture diagram resources

This directory saves the detailed architecture diagram of the case: SVG for Markdown and GitHub preview, and Draw.io source file for continued editing.

## Visual convention

- Blue: Synchronous requests and online services;
- Purple: asynchronous processing and message queue;
- Green: cache, database, index and persistent storage;
- Orange: CDN, edge nodes and external delivery;
- Solid arrow: synchronous call or main data flow;
- Dotted arrow: asynchronous events, CDN Origin Fetch or derived data flow;
- Cylinder: database; multi-layer disk: object storage; stacked rectangle: service cluster; queue shape: messaging system.

It is recommended to use the Draw.io Integration extension of VS Code to edit the source file and export the SVG with the same name after modification.

## Editable source file

- [Video Streaming Architecture Diagram](video-streaming-architecture.drawio): Editable nodes, connecting lines, colors and groups.
- [Video Streaming SVG Preview](video-streaming-architecture.svg): for Markdown and GitHub display.
