import { beforeEach, describe, expect, test, vi } from "vitest";

import { vexService } from "../service.ts";

type TestClient = {
    close: ReturnType<typeof vi.fn>;
    me: {
        changePassword: ReturnType<typeof vi.fn>;
    };
    passkeys: {
        resetPassword: ReturnType<typeof vi.fn>;
    };
};

const serviceInternals = vexService as unknown as {
    client: null | TestClient;
};

beforeEach(async () => {
    await vexService.close();
    serviceInternals.client = null;
});

describe("vexService password operations", () => {
    test("changes a password through the approved device session", async () => {
        const client = makeClient();
        serviceInternals.client = client;

        await expect(
            vexService.changePassword(
                "This is the current password",
                "This is the replacement password",
            ),
        ).resolves.toEqual({ ok: true });

        expect(client.me.changePassword).toHaveBeenCalledWith(
            "This is the current password",
            "This is the replacement password",
        );
        expect(client.passkeys.resetPassword).not.toHaveBeenCalled();
    });

    test("resets a password through the fresh passkey session", async () => {
        const client = makeClient();
        serviceInternals.client = client;

        await expect(
            vexService.resetPasswordWithPasskey(
                "This is the recovered account password",
            ),
        ).resolves.toEqual({ ok: true });

        expect(client.passkeys.resetPassword).toHaveBeenCalledWith(
            "This is the recovered account password",
        );
        expect(client.me.changePassword).not.toHaveBeenCalled();
    });

    test("returns protocol errors without disguising a failed replacement", async () => {
        const client = makeClient();
        client.me.changePassword.mockRejectedValueOnce(
            new Error("Current password is incorrect"),
        );
        serviceInternals.client = client;

        await expect(
            vexService.changePassword(
                "This is the wrong current password",
                "This is the replacement password",
            ),
        ).resolves.toEqual({
            error: "Current password is incorrect",
            ok: false,
        });
    });
});

function makeClient(): TestClient {
    return {
        close: vi.fn(async () => undefined),
        me: {
            changePassword: vi.fn(async () => undefined),
        },
        passkeys: {
            resetPassword: vi.fn(async () => undefined),
        },
    };
}
