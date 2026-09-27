import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { t } from "../i18n/index.js";

import {
  allDevEventNames,
  DataLogLevel,
  DevDataLogEvent,
  devDataSchemas,
} from "knoxdev-package/config-yaml";
import { fetchwithRequestOptions } from "knoxdev-package/fetch";
import * as URI from "../util/uriApi.js";
import { ZodObject } from "zod";

import { Core } from "../core.js";
import { IdeInfo, IdeSettings } from "../index.js";
import { getDevDataFilePath } from "../util/paths.js";

const DEFAULT_DEV_DATA_LEVEL: DataLogLevel = "all";
export class DataLogger {
  private static instance: DataLogger | null = null;
  core?: Core;
  ideSettingsPromise?: Promise<IdeSettings>;
  ideInfoPromise?: Promise<IdeInfo>;

  private constructor() {}

  public static getInstance(): DataLogger {
    if (DataLogger.instance === null) {
      DataLogger.instance = new DataLogger();
    }
    return DataLogger.instance;
  }

  async addBaseValues(
    body: Record<string, any>,
    eventName: string,
    zodSchema: ZodObject<any>,
  ): Promise<Record<string, any>> {
    const newBody = { ...body };
    const ideSettings = await this.ideSettingsPromise;
    const ideInfo = await this.ideInfoPromise;

    if ("eventName" in zodSchema.shape) {
      newBody.eventName = eventName;
    }
    if (!newBody.timestamp && "timestamp" in zodSchema.shape) {
      newBody.timestamp = new Date().toISOString();
    }
    if ("userAgent" in zodSchema.shape) {
      newBody.userAgent = ideInfo
        ? `${ideInfo.name}/${ideInfo.version} (Knox/${ideInfo.extensionVersion})`
        : "Unknown/Unknown (Knox/Unknown)";
    }
    if ("selectedProfileId" in zodSchema.shape) {
      newBody.selectedProfileId =
        this.core?.configHandler.currentProfile?.profileDescription.id ?? "";
    }
    if ("userId" in zodSchema.shape) {
      newBody.userId = "";
    }

    return newBody;
  }

  async logDevData(event: DevDataLogEvent) {
    // Local logs (always on for all levels)
    try {
      const filepath: string = getDevDataFilePath(event.name);
      const localSchema = devDataSchemas["all"][event.name];

      if (!localSchema) {
        throw new Error(
          `Schema doesn't exist at level "all" for event "${event.name}"`,
        );
      }

      const eventDataWithBaseValues = await this.addBaseValues(
        event.data,
        event.name,
        localSchema,
      );

      const parsed = localSchema?.safeParse(eventDataWithBaseValues);
      if (parsed?.success) {
        fs.writeFileSync(filepath, `${JSON.stringify(parsed.data)}\n`, {
          flag: "a",
        });
      }
    } catch (error) {
      console.error(t("errorLoggingLocalDevData"), error);
    }

    // Remote logs
    const config = (await this.core?.configHandler.loadConfig())?.config;
    if (config?.data?.length) {
      await Promise.allSettled(
        config.data.map(async (dataConfig) => {
          try {
            const level = dataConfig.level ?? DEFAULT_DEV_DATA_LEVEL;

            // Skip event if `events` is specified and does not include the event
            const events = dataConfig.events ?? allDevEventNames;
            if (!events.includes(event.name)) {
              return;
            }

            const levelSchemas = devDataSchemas[level];
            if (!levelSchemas) {
              throw new Error(
                `Attempting to log dev data at level ${level} which does not exist`,
              );
            }

            const zodSchema = levelSchemas[event.name];
            if (!zodSchema) {
              throw new Error(
                `Attempting to log dev data for event ${event.name} at level ${level}: no schema found`,
              );
            }

            const eventDataWithBaseValues = await this.addBaseValues(
              event.data,
              event.name,
              zodSchema,
            );

            const parsed = zodSchema.safeParse(eventDataWithBaseValues);
            if (!parsed.success) {
              throw new Error(
                `Failed to parse event data for event ${event.name}\n:${parsed.error.toString()}`,
              );
            }

            const uriComponents = URI.parse(dataConfig.destination);

            // Send to remote server
            if (
              uriComponents.scheme === "https" ||
              uriComponents.scheme === "http"
            ) {
              const headers: Record<string, string> = {
                "Content-Type": "application/json",
              };
              if (dataConfig.apiKey) {
                headers["Authorization"] = `Bearer ${dataConfig.apiKey}`;
              }

              // For events going to Knox, overwrite the access token
              const profileId =
                this.core?.configHandler.currentProfile?.profileDescription
                  .id ?? "";
              const response = await fetchwithRequestOptions(
                dataConfig.destination,
                {
                  method: "POST",
                  headers,
                  body: JSON.stringify({
                    name: event.name,
                    data: parsed.data,
                    level,
                    profileId,
                  }),
                },
                dataConfig.requestOptions,
              );
              if (!response.ok) {
                throw new Error(
                  `Post request failed. ${response.status}: ${response.statusText}`,
                );
              }
            } else if (uriComponents.scheme === "file") {
              // Write to jsonl file for local file URIs
              const dirUri = dataConfig.destination;
              const dirPath = fileURLToPath(dirUri);

              if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
              }
              const filepath = path.join(dirPath, `${event.name}.jsonl`);
              const jsonLine = JSON.stringify(event.data);
              fs.writeFileSync(filepath, `${jsonLine}\n`, { flag: "a" });
            } else {
              throw new Error(t("unsupportedUriScheme", { scheme: uriComponents.scheme }));
            }
          } catch (error) {
            console.error(
              t("errorLoggingData", { destination: dataConfig.destination, error: error instanceof Error ? error.message : error }),
            );
          }
        }),
      );
    }
  }
}
