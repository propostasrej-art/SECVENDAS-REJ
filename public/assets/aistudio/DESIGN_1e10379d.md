---
name: Document Intelligence System
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#464555'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#777587'
  outline-variant: '#c7c4d8'
  surface-tint: '#4d44e3'
  primary: '#3525cd'
  on-primary: '#ffffff'
  primary-container: '#4f46e5'
  on-primary-container: '#dad7ff'
  inverse-primary: '#c3c0ff'
  secondary: '#4648d4'
  on-secondary: '#ffffff'
  secondary-container: '#6063ee'
  on-secondary-container: '#fffbff'
  tertiary: '#41485e'
  on-tertiary: '#ffffff'
  tertiary-container: '#586076'
  on-tertiary-container: '#d4dbf5'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2dfff'
  primary-fixed-dim: '#c3c0ff'
  on-primary-fixed: '#0f0069'
  on-primary-fixed-variant: '#3323cc'
  secondary-fixed: '#e1e0ff'
  secondary-fixed-dim: '#c0c1ff'
  on-secondary-fixed: '#07006c'
  on-secondary-fixed-variant: '#2f2ebe'
  tertiary-fixed: '#dae2fd'
  tertiary-fixed-dim: '#bec6e0'
  on-tertiary-fixed: '#131b2e'
  on-tertiary-fixed-variant: '#3f465c'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  title-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 22px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: 0em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0.01em
  label-lg:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.04em
  caption:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-mobile: 0.75rem
  margin: 1rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

This design system drives a mission-critical mobile enterprise tool dedicated to document extraction, optical parsing, validation, and operational governance. It is designed primarily for financial analysts, operations managers, and field auditors who need to rapidly assess ingestion queues, audit extraction confidence, and approve high-value contracts on touch-first displays.

The aesthetic fuses **Corporate / Modern clarity** with a **Tactile High-Density Utility**. It avoids decorative friction, prioritizing rapid scanability, instantaneous state parsing, and confident single-thumb execution. The UI evokes reliability, analytical rigor, and effortless oversight, transforming complex data validation loops into crisp, structured mobile workflows.

## Colors

The palette establishes an authoritative, high-trust operational environment centered on an indigo spectrum, anchored by architectural neutrals and crisp functional indicators.

### Core Roles
- **Primary Indigo (`#4F46E5`)**: Primary actions, critical progression paths, focused tab bars, and active document state highlights.
- **Secondary Indigo Tint (`#6366F1`)**: Interactive hover/press states, progress indicators, extraction bounding-box highlights, and accent accents.
- **Slate Heavy (`#0F172A`)**: Primary typography, high-priority numeric data points, and structural headers.
- **Surface Canvas (`#F8FAFC`)**: Canvas base creating subtle contrast against white container cards.
- **Surface Elevated (`#FFFFFF`)**: Pure white card layers, sheets, and modal views.
- **Border Subtle (`#E2E8F0`)**: Low-contrast structural boundaries maintaining separation without clutter.

### Semantic Status Palette
- **Queue & Pending (`#F59E0B` / `#D97706`)**: Ambient amber indicators denoting items in queue, awaiting signature, or OCR extraction in progress.
- **Approved & Executed (`#10B981`)**: High-confidence green signifying validated contracts, verified extractions, and compliant documents.
- **Settled & Dispatched (`#3B82F6`)**: Corporate blue applied to deeded, archived, and payment-dispatched workflows.
- **Critical & Returned (`#EF4444`)**: Direct crimson flagging processing errors, field mismatches, and returned/canceled contracts.

## Typography

The type system is built on **Inter**, optimized for mobile screen legibility, dense tabular metadata, and rapid visual hierarchy. 

- **Weight Discipline**: Weight selections are restricted to `400` (Regular) for descriptive body copy and extraction dumps, `500` (Medium) for auxiliary metadata and breadcrumbs, `600` (SemiBold) for structural labels and component triggers, and `700` (Bold) strictly for key numeric totals and screen headers.
- **Tabular Figures**: All document counters, monetary values, and extraction confidence percentages must use `font-variant-numeric: tabular-nums` to ensure stable vertical alignment in lists and summary cards.
- **Micro-Labels**: Status pills, extraction tags, and stage chips employ `label-sm` or `caption` with slight uppercase tracking (`+0.04em` to `+0.05em`) to ensure legibility on dark or tinted semantic backdrops.

## Layout & Spacing

The layout uses a **fluid, mobile-first single-column structure** constrained to a maximum width of 480px on handheld screens, scaling gracefully to a multi-column dashboard on tablets (768px+) and desktop monitors.

- **Mobile Canvas**: Uses an outer boundary margin of `margin-mobile` (16px), with inner component cards spanning full edge-to-edge minus margins to maximize screen real estate.
- **Touch Optimization**: Vertical rhythm between interactive cards follows `space-lg` (16px), while grouped data points within cards utilize `space-sm` (8px) and `space-md` (12px).
- **Safe Area Insets**: Floating bottom navigation bars and floating review triggers must explicitly respect `env(safe-area-inset-bottom)` with a minimum supplemental bottom padding of `space-lg`.
- **Horizontal Scrolling Trays**: Status filter chips and queue stage switchers use negative-margin bleeding to allow seamless edge-to-edge swiping without breaking container alignment.

## Elevation & Depth

Visual depth is achieved through **low-contrast outlines combined with ultra-soft ambient light dispersion**, ensuring screens remain lightweight, clean, and glare-free under diverse enterprise lighting conditions.

- **Level 0 (Base Canvas)**: Background at `#F8FAFC`, flat, zero shadow.
- **Level 1 (Cards & Feed Panels)**: Solid white surface (`#FFFFFF`) with a 1px boundary of `#E2E8F0` and an ambient shadow: `0px 1px 3px rgba(15, 23, 42, 0.04), 0px 4px 8px rgba(15, 23, 42, 0.02)`.
- **Level 2 (Active/Pressed Cards & Dropdowns)**: Elevated card state with shadow: `0px 4px 12px rgba(15, 23, 42, 0.08), 0px 1px 2px rgba(15, 23, 42, 0.04)`.
- **Level 3 (Modals, Bottom Sheets & Sticky Action Trays)**: Maximum tactile depth using `0px -4px 20px rgba(15, 23, 42, 0.08)` coupled with an upper boundary of `#E2E8F0` to distinguish the action surface from the scrolling feed below.

## Shapes

The shape system centers on approachable enterprise ergonomics with prominent `rounded-2xl` surfaces that soften complex analytical data.

- **Cards & Ingestion Modules**: Set strictly to `rounded-2xl` (16px / 1rem to 1.5rem depending on viewport) to produce distinct, tactile data pods.
- **Primary Action Buttons**: Set to `rounded-xl` (12px) to feel substantial and clickable without descending into hyper-casual pill shapes.
- **Status Badges & Chips**: Micro-components employ fully rounded pill shapes (`rounded-full`) to immediately differentiate metadata tags from clickable card surfaces.
- **Form Fields & OCR Snippet Previews**: Styled with `rounded-xl` (12px) matching the action buttons for holistic form symmetry.

## Components

### Buttons
- **Touch Ergonomics**: All interactive buttons enforce a minimum touch target height of 48px (preferably 52px for primary actions).
- **Primary Variant**: Solid `#4F46E5` background, text in `#FFFFFF`, with `label-lg` font style. Active press scales down slightly (`scale(0.98)`) and shifts to `#4338CA`.
- **Secondary Variant**: `#FFFFFF` background, 1px border of `#E2E8F0`, text in `#0F172A`. Active state applies a subtle tint of `#F1F5F9`.
- **Destructive/Return Variant**: Soft red fill (`rgba(239, 68, 68, 0.1)`), borderless, with `#EF4444` label for secondary rejections; solid `#EF4444` fill for irreversible cancellations.

### Badges & Semantic Chips
- **Status Badges**: Constructed with a soft 10% opacity semantic background tint, matching 100% solid foreground text, and an inner 1px border (e.g., Aprovado uses background `#ECFDF5`, text `#10B981`, border `rgba(16, 185, 129, 0.2)`).
- **Interactive Queue Filters**: Horizontally scrollable chips with 36px height, `rounded-full` contour, resting on `#FFFFFF` with `#E2E8F0` border. Active filter adopts solid `#0F172A` with `#FFFFFF` text.

### Document Cards
- **Structure**: Surface `#FFFFFF`, border 1px solid `#E2E8F0`, border-radius `rounded-2xl` (16px), padding `space-lg` (16px).
- **Header Slot**: Left-aligned contract/document identifier (`title-md`) paired with a right-aligned semantic status badge (`label-sm`).
- **Body Slot**: Two-column key-value matrix showcasing critical extraction metrics: Extraction Confidence (percentage), Timestamp, Document Type (e.g., CCB, Escritura), and Counterparty Name.
- **Footer Slot**: Quick inline validation actions (e.g., "Visualizar", "Aprovar") separated by a fine `0.5px` hairline divider of `#F1F5F9`.

### Input Fields & Search Bars
- **Containers**: 48px height, background `#FFFFFF`, border 1px solid `#E2E8F0`, radius `rounded-xl` (12px), text `body-md` in `#0F172A`.
- **Focus State**: Indigo border ring `2px solid #4F46E5` with smooth transition; placeholder text in `#94A3B8`.
- **Clear & Scan Triggers**: Right-aligned 24x24px iconography for fast barcode/camera scan activation and single-tap input clearing.

### Checkboxes & Verification Toggles
- **Hit Area**: 44x44px invisible touch bounding box housing a 20x20px visual control with `rounded-md` corners.
- **Checked State**: Solid `#4F46E5` with `#FFFFFF` checkmark vector.
- **Batch Selection Bar**: Floating bar anchored above safe-area bottom when items are checked, providing instantaneous count and bulk-action buttons ("Aprovar Selecionados", "Mover Fila").

### Bottom Sheets (Document Preview & Confidence Inspector)
- **Top Handle**: Centered pill indicator (36px width, 4px height, `#CBD5E1`), radius `rounded-full`, with 8px top margin.
- **Inspection Split**: Top half renders zoomed OCR extracted crop; bottom half presents editable key-value fields with confidence score rings (Green > 90%, Amber 70-89%, Red < 70%).