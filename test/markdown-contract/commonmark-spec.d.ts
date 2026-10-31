/** The CommonMark spec's examples, as the `commonmark-spec` package exports them. */
declare module 'commonmark-spec' {
  const spec: {
    readonly tests: readonly {
      readonly markdown: string;
      readonly html: string;
      readonly section: string;
      readonly number: number;
    }[];
  };
  export default spec;
}
