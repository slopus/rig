export interface UserInputOption {
    description: string;
    label: string;
}

export interface UserInputQuestion {
    header: string;
    id: string;
    multiSelect: boolean;
    options: readonly UserInputOption[];
    question: string;
}

export interface UserInputRequest {
    questions: readonly UserInputQuestion[];
    requestId: string;
}

export interface UserInputResponse {
    answers: Readonly<Record<string, readonly string[]>>;
}
