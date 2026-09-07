import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ToolCallState } from "core";
import {
  parseAskUserQuestions,
  type AskUserQuestion,
} from "core/tools/implementations/askUser";
import { Check } from "lucide-react";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle,
  splitChoiceText,
} from "../../../components/ui/questionnaire";
import { useAppDispatch } from "../../../redux/hooks";
import { answerAskUser } from "../../../redux/thunks/answerAskUser";
import { cancelTool } from "../../../redux/thunks/cancelTool";

function toQuestionnaireItems(questions: AskUserQuestion[]) {
  return questions.map((question) => ({
    name: question.id,
    prompt: question.prompt,
    required: true,
    multiple: question.allow_multiple === true,
    choices: question.options?.map(splitChoiceText),
    input:
      question.allow_freeform || !question.options?.length
        ? { label: question.prompt }
        : undefined,
  }));
}

function formatAnswer(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value.filter((item) => item.trim().length > 0).join(", ");
  }
  return typeof value === "string" ? value.trim() : "";
}

export function AskUser({
  toolCallState,
}: {
  toolCallState: ToolCallState;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const questions = useMemo(() => {
    try {
      return parseAskUserQuestions(toolCallState.parsedArgs?.questions ?? []);
    } catch {
      return [] as AskUserQuestion[];
    }
  }, [toolCallState.parsedArgs]);

  const items = useMemo(() => toQuestionnaireItems(questions), [questions]);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});

  const waiting = toolCallState.status === "generated";
  const declined = toolCallState.status === "canceled";

  if (!questions.length) {
    return (
      <div className="text-muted-foreground px-2 pb-2 text-sm">
        {t("askUserInvalid")}
      </div>
    );
  }

  if (!waiting) {
    return (
      <Card className="border-border/80 bg-card/70 mb-2 shadow-sm">
        <CardContent className="flex flex-col gap-2.5 p-3">
          {questions.map((question) => {
            const rendered = formatAnswer(answers[question.id]);
            return (
              <div key={question.id} className="min-w-0">
                <div className="text-xs text-muted-foreground">
                  {question.prompt}
                </div>
                <div className="mt-0.5 flex items-start gap-1.5 text-sm">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="min-w-0 leading-snug">
                    {rendered ||
                      (declined ? t("askUserDeclined") : t("askUserAnswered"))}
                  </span>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    );
  }

  return (
    <Questionnaire
      items={items}
      answers={answers}
      onAnswersChange={setAnswers}
      disabled={!waiting}
      onSubmit={() =>
        void dispatch(
          answerAskUser({
            toolCallId: toolCallState.toolCallId,
            answers,
          }),
        )
      }
    >
      <Card className="border-border/80 bg-card/70 mb-2 shadow-sm">
        {items.length > 1 ? (
          <CardHeader className="space-y-2 p-3 pb-0">
            <QuestionnaireProgress>
              {({ current, total }) =>
                t("askUserProgress", { current, total })
              }
            </QuestionnaireProgress>
          </CardHeader>
        ) : null}
        <CardContent className="p-3">
          {items.map((item) => (
            <QuestionnaireItem key={item.name} name={item.name}>
              <QuestionnaireTitle>{item.prompt}</QuestionnaireTitle>
              {item.multiple ? (
                <QuestionnaireDescription>
                  {t("askUserMultipleHint")}
                </QuestionnaireDescription>
              ) : null}
              {item.choices?.length ? (
                <QuestionnaireChoices>
                  {item.choices.map((choice) => (
                    <QuestionnaireChoice
                      key={choice.value}
                      value={choice.value}
                      label={choice.label}
                      description={choice.description}
                    />
                  ))}
                </QuestionnaireChoices>
              ) : null}
              {item.input ? (
                <QuestionnaireInput
                  aria-label={t("askUserFreeformLabel")}
                  placeholder={t("askUserFreeform")}
                />
              ) : null}
            </QuestionnaireItem>
          ))}
        </CardContent>
        <CardFooter className="p-3 pt-0">
          <QuestionnaireActions className="w-full">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => dispatch(cancelTool())}
            >
              {t("deny")}
            </Button>
            <QuestionnairePrevious className="flex-1">
              {t("askUserPrevious")}
            </QuestionnairePrevious>
            <QuestionnaireNext className="flex-1">
              {t("askUserNext")}
            </QuestionnaireNext>
            <QuestionnaireSubmit className="flex-1">
              {t("askUserSubmit")}
            </QuestionnaireSubmit>
          </QuestionnaireActions>
        </CardFooter>
      </Card>
    </Questionnaire>
  );
}
