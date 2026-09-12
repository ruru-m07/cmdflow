import type { DialogProps, InputProps } from "../src/index.js";

// @ts-expect-error Dialog visibility belongs to the engine, not the native attribute.
const dialog: DialogProps = { open: true };
// @ts-expect-error Query changes go through the engine.
const input: InputProps = { value: "host value" };
// @ts-expect-error Initial query belongs to the engine as well.
const initialInput: InputProps = { defaultValue: "host default" };
void [dialog, input, initialInput];
