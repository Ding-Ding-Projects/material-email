# Material interface and accessibility

## Status

**Renderer integrated with focused Electron accessibility verification.** Dirty-state decisions, modal focus containment/return, workspace-tab roving focus, load errors, representative bilingual semantics, reduced-motion timing, and collision-safe focused popovers pass; full visual and assistive-technology matrices remain open.

## Behavior

The planned application shell uses a Windows title bar, navigation rail, browser-style workspace tabs, and discrete Mail, Settings, Changelog, History, Notifications, and Tools panels. Mail uses folder, message-list, and reader panes. Informational feedback appears as corner notifications rather than blocking dialogs.

Semantic tab/tablist/tabpanel relationships, roving tab focus, named controls, live regions, skip navigation, and keyboard commands are part of the implementation contract. The primary workspace tab strip now keeps focus on the selected tab during arrow, Home, and End navigation and uses an inset focus indicator that remains inside the horizontally scrollable strip. Compose and PIM forms compare against loaded/saved dirty baselines before prompting, and either dirty editor prevents an unreviewed whole-window unload. Their discard decision is named and keyboard operable, cancellation returns focus to the originating control, and PIM load failures remain visible with an explicit retry action rather than collapsing into an empty page.

## Configuration

Preferences include system/light/dark theme, compact/comfortable/relaxed density, accent color, font family, scale, and weight. The supported window minimum is 760 × 560, but every surface must also be tested at Windows scaling from 100% through 200% and with bilingual labels.

## Failure modes

- A semantic attribute in source can still be wrong after dynamic updates.
- Long Cantonese/bilingual labels can clip or move actions off-screen.
- Custom title bars and drag regions can make controls unreachable.
- Popovers can detach from anchors near viewport edges.
- Focus can be lost when tabs close, groups collapse, dialogs dismiss, or data rerenders.
- motion, color, and density choices can reduce usability if contrast and target sizes are not recalculated.

## Security considerations

Never render untrusted message markup into the application chrome. Accessibility names and notifications must not expose message content on a locked/shared screen without a privacy setting. Destructive actions retain clear factual labels at every humor level.

## Verification

The previously recorded 15-scenario Electron suite covers dirty baselines, replacement and unload prevention, async editor ownership, the accessible discard decision, modal Tab/Escape containment, exact focus return, explicit PIM load-error retry, and representative bilingual language semantics at 760 × 560. A separate focused real-Electron regression passes for workspace-tab Arrow/End/Home focus, roving tabindex state, tab/tabpanel naming, and the visible inset focus rule. Two new focused real-Electron scenarios cover the expanded tab editor plus the History and Changelog calendars at 760 × 560 and smaller effective CSS viewports: each floating surface remains inside the viewport without horizontal overflow, retains its active control during reflow, exposes its scrollable completion controls, and returns focus to its trigger. Reduced-motion emulation also proves zero transition delay and a 1 ms transition duration. The 608 × 448, 507 × 373, and 380 × 280 sizes are stress proxies only; native Windows 100/125/150/200% display scaling was not exercised. Full keyboard traversal, native screen-reader announcements, high-contrast mode, forced colors, native display scaling, RTL, clean-machine rendering, and Windows title-bar behavior remain open.

## Suggested articles

- [Appearance customization](appearance-customization.md)
- [Tabs and discovery](tabs-and-discovery.md)
- [Language and humor controls](language-and-humor.md)
