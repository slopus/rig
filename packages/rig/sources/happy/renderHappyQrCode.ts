import { Image, getCapabilities } from "@earendil-works/pi-tui";
import QRCode from "qrcode";
import qrCodeTerminal from "qrcode-terminal";

export async function renderHappyQrCode(
    url: string,
    options: { imageOutput?: boolean; width?: number } = {},
): Promise<void> {
    const supportsImages = options.imageOutput ?? getCapabilities().images !== null;
    if (supportsImages) {
        const png = await QRCode.toBuffer(url, {
            errorCorrectionLevel: "M",
            margin: 4,
            type: "png",
            width: 512,
        });
        const image = new Image(
            png.toString("base64"),
            "image/png",
            { fallbackColor: (value) => value },
            {
                filename: "Happy authentication QR code",
                maxHeightCells: 18,
                maxWidthCells: 36,
            },
        );
        process.stdout.write(
            `${image.render(options.width ?? process.stdout.columns ?? 80).join("\n")}\n`,
        );
        return;
    }

    const qr = await new Promise<string>((resolve) => {
        qrCodeTerminal.generate(url, { small: true }, resolve);
    });
    for (const line of qr.split("\n")) console.log(`${" ".repeat(10)}${line}`);
}
