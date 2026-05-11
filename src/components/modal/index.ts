export interface Modal {
    prompt(options: {
        title: string;
        input?: { type: string };
        defaultValue?: string;
    }): Promise<string | null>;
}
