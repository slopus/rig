export interface Identity {
    name: string;
    prompt: string;
}

export const DEFAULT_IDENTITY: Identity = {
    name: "Rig",
    prompt: "You are Rig, built by Happy",
};
