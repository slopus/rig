export function wrapGrokUserQuery(query: string): string {
    return `<user_query>\n${query}\n</user_query>`;
}
