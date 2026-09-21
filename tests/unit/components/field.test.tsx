import { Fragment, useRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Field, RequiredNote, inputClass } from "@/components/ui/Field";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-first-invalid";

// Sem `globals`, o Testing Library não limpa o DOM sozinho: ids repetidos entre testes embaralham as consultas.
afterEach(cleanup);

describe("Field: o campo sabe do erro, da dica e de ser obrigatório", () => {
  it("liga o erro ao campo (descrição acessível) e marca aria-invalid", () => {
    render(
      <Field id="nome" label="Nome" error="Informe o nome.">
        <input id="nome" className={inputClass} />
      </Field>
    );

    const input = screen.getByLabelText("Nome");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Informe o nome.");
    expect(screen.getByRole("alert")).toHaveTextContent("Informe o nome.");
  });

  it("sem erro, o campo não é marcado como inválido", () => {
    render(
      <Field id="nome" label="Nome">
        <input id="nome" />
      </Field>
    );

    expect(screen.getByLabelText("Nome")).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a dica descreve o campo e dá lugar ao erro quando ele aparece", () => {
    const { rerender } = render(
      <Field id="senha" label="Nova senha" hint="Pelo menos 10 caracteres.">
        <input id="senha" />
      </Field>
    );
    expect(screen.getByLabelText("Nova senha")).toHaveAccessibleDescription("Pelo menos 10 caracteres.");

    rerender(
      <Field id="senha" label="Nova senha" hint="Pelo menos 10 caracteres." error="Senha curta demais.">
        <input id="senha" />
      </Field>
    );
    expect(screen.getByLabelText("Nova senha")).toHaveAccessibleDescription("Senha curta demais.");
  });

  it("obrigatório: aria-required no campo e o asterisco fora do nome dele", () => {
    render(
      <Field id="nome" label="Nome" required>
        <input id="nome" />
      </Field>
    );

    const input = screen.getByLabelText("Nome", { exact: true });
    expect(input).toHaveAttribute("aria-required", "true");
    // Só `aria-required`: o `required` nativo faria o navegador barrar o envio antes da validação do app.
    expect(input).not.toHaveAttribute("required");
    expect(screen.getByRole("textbox", { name: "Nome" })).toBe(input);
  });

  it("mantém o aria-describedby que o próprio campo já tinha", () => {
    render(
      <>
        <p id="extra">Só letras.</p>
        <Field id="nome" label="Nome" error="Informe o nome.">
          <input id="nome" aria-describedby="extra" />
        </Field>
      </>
    );

    expect(screen.getByLabelText("Nome")).toHaveAccessibleDescription("Só letras. Informe o nome.");
  });

  it("filho que não é um campo único (fragmento) passa como veio, sem aviso do React", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <Field id="forn" label="Fornecedor" error="Escolha um.">
        <Fragment>
          <select id="forn" aria-label="Fornecedor cadastrado" />
          <input aria-label="Nome do fornecedor" />
        </Fragment>
      </Field>
    );

    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Escolha um.");
    spy.mockRestore();
  });

  it("a borda do campo não é a clara demais que dava 1,5:1", () => {
    expect(inputClass).not.toMatch(/border-slate-(50|100|200|300)\b/);
  });

  it("RequiredNote explica o asterisco", () => {
    render(<RequiredNote />);
    expect(screen.getByText(/Campo obrigatório/)).toBeInTheDocument();
  });
});

function Demo({ errors }: { errors: Record<string, string | undefined> }) {
  const ref = useRef<HTMLFormElement>(null);
  useFocusFirstInvalid(ref, errors);
  return (
    <form ref={ref}>
      <Field id="a" label="Campo A" error={errors.a}>
        <input id="a" />
      </Field>
      <Field id="b" label="Campo B" error={errors.b}>
        <input id="b" />
      </Field>
      <Field id="c" label="Campo C" error={errors.c}>
        <input id="c" />
      </Field>
    </form>
  );
}

describe("useFocusFirstInvalid", () => {
  it("leva o foco ao PRIMEIRO campo com erro, na ordem da tela", () => {
    const { rerender } = render(<Demo errors={{}} />);
    expect(document.body).toHaveFocus();

    rerender(<Demo errors={{ c: "erro c", b: "erro b" }} />);
    expect(screen.getByLabelText("Campo B")).toHaveFocus();
  });

  it("sem erro nenhum, não rouba o foco de quem está digitando", () => {
    const { rerender } = render(<Demo errors={{}} />);
    screen.getByLabelText("Campo C").focus();

    rerender(<Demo errors={{ a: undefined }} />);
    expect(screen.getByLabelText("Campo C")).toHaveFocus();
  });
});
