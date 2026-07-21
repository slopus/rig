export interface XSearchInput {
    query: string;
    allowed_x_handles?: readonly string[];
    excluded_x_handles?: readonly string[];
    from_date?: string;
    to_date?: string;
    enable_image_understanding?: boolean;
    enable_video_understanding?: boolean;
}

export interface XSearchOutput {
    query: string;
    response: string;
    durationSeconds: number;
}
