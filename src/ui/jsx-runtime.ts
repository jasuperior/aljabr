import { type ViewNode, type Child, Fragment as FragmentSymbol, view } from "./view-node.ts";

export { FragmentSymbol as Fragment };

// ---------------------------------------------------------------------------
// JSX element factory — called by the TypeScript JSX transform when
// jsxImportSource is set to "aljabr/ui" in tsconfig.
// ---------------------------------------------------------------------------

type JsxProps = Record<string, unknown> & { children?: unknown };

function _jsx(type: typeof FragmentSymbol, props: { children?: unknown }, _key?: string): ViewNode;
function _jsx(type: string, props: JsxProps, _key?: string): ViewNode;
function _jsx<P extends Record<string, unknown>>(type: (props: P) => ViewNode, props: P & { children?: unknown }, _key?: string): ViewNode;
function _jsx(
    type: string | typeof FragmentSymbol | ((props: Record<string, unknown>) => ViewNode),
    props: JsxProps,
    _key?: string,
): ViewNode {
    const { children: rawChildren, ...ownProps } = props;

    if (type === FragmentSymbol) {
        const children = normalizeChildren(rawChildren);
        return view(FragmentSymbol, null, ...children);
    }

    if (typeof type === "function") {
        // Component — pass all props (including children) as a single object
        return view(type as (props: Record<string, unknown>) => ViewNode, { ...ownProps, ...(rawChildren !== undefined ? { children: rawChildren } : {}) });
    }

    // Intrinsic element
    const children = normalizeChildren(rawChildren);
    return view(type, Object.keys(ownProps).length > 0 ? ownProps : null, ...children);
}

function normalizeChildren(raw: unknown): Child[] {
    if (raw === undefined) return [];
    if (Array.isArray(raw)) return raw as Child[];
    return [raw as Child];
}

export const jsx = _jsx;
export const jsxs = _jsx;
export const jsxDEV = _jsx;

// ---------------------------------------------------------------------------
// JSX namespace — TypeScript intrinsic element types
// ---------------------------------------------------------------------------

type HTMLProps = Record<string, unknown>;

export namespace JSX {
    export type Element = ViewNode;

    export interface ElementChildrenAttribute {
        children: unknown;
    }

    export interface IntrinsicElements {
        // Common HTML elements — all accept arbitrary props for flexibility
        a: HTMLProps;
        abbr: HTMLProps;
        address: HTMLProps;
        article: HTMLProps;
        aside: HTMLProps;
        audio: HTMLProps;
        b: HTMLProps;
        blockquote: HTMLProps;
        body: HTMLProps;
        br: HTMLProps;
        button: HTMLProps;
        canvas: HTMLProps;
        caption: HTMLProps;
        cite: HTMLProps;
        code: HTMLProps;
        col: HTMLProps;
        colgroup: HTMLProps;
        data: HTMLProps;
        datalist: HTMLProps;
        dd: HTMLProps;
        del: HTMLProps;
        details: HTMLProps;
        dfn: HTMLProps;
        dialog: HTMLProps;
        div: HTMLProps;
        dl: HTMLProps;
        dt: HTMLProps;
        em: HTMLProps;
        fieldset: HTMLProps;
        figcaption: HTMLProps;
        figure: HTMLProps;
        footer: HTMLProps;
        form: HTMLProps;
        h1: HTMLProps;
        h2: HTMLProps;
        h3: HTMLProps;
        h4: HTMLProps;
        h5: HTMLProps;
        h6: HTMLProps;
        head: HTMLProps;
        header: HTMLProps;
        hr: HTMLProps;
        html: HTMLProps;
        i: HTMLProps;
        iframe: HTMLProps;
        img: HTMLProps;
        input: HTMLProps;
        ins: HTMLProps;
        kbd: HTMLProps;
        label: HTMLProps;
        legend: HTMLProps;
        li: HTMLProps;
        link: HTMLProps;
        main: HTMLProps;
        map: HTMLProps;
        mark: HTMLProps;
        menu: HTMLProps;
        meta: HTMLProps;
        meter: HTMLProps;
        nav: HTMLProps;
        noscript: HTMLProps;
        object: HTMLProps;
        ol: HTMLProps;
        optgroup: HTMLProps;
        option: HTMLProps;
        output: HTMLProps;
        p: HTMLProps;
        picture: HTMLProps;
        pre: HTMLProps;
        progress: HTMLProps;
        q: HTMLProps;
        rp: HTMLProps;
        rt: HTMLProps;
        ruby: HTMLProps;
        s: HTMLProps;
        samp: HTMLProps;
        script: HTMLProps;
        section: HTMLProps;
        select: HTMLProps;
        small: HTMLProps;
        source: HTMLProps;
        span: HTMLProps;
        strong: HTMLProps;
        style: HTMLProps;
        sub: HTMLProps;
        summary: HTMLProps;
        sup: HTMLProps;
        table: HTMLProps;
        tbody: HTMLProps;
        td: HTMLProps;
        template: HTMLProps;
        textarea: HTMLProps;
        tfoot: HTMLProps;
        th: HTMLProps;
        thead: HTMLProps;
        time: HTMLProps;
        title: HTMLProps;
        tr: HTMLProps;
        track: HTMLProps;
        u: HTMLProps;
        ul: HTMLProps;
        var: HTMLProps;
        video: HTMLProps;
        wbr: HTMLProps;
        [tag: string]: HTMLProps;
    }
}
