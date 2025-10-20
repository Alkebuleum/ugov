export declare function preOpenAmvaultPopup(name?: string, w?: number, h?: number): Window | null;
export declare function getSharedPopup(): Window | null;
export declare function closeSharedPopup(): Promise<void>;
export declare function closePopupThen(cb: () => void): Promise<void>;
