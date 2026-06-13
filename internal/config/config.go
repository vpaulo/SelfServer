package config

import (
	"os"
	"path/filepath"

	"github.com/pelletier/go-toml/v2"
)

type CommandPackage struct {
	Path          string   `toml:"path"`
	PM            string   `toml:"pm"`
	HiddenScripts []string `toml:"hidden_script,omitempty"`
}

type ProjectConfig struct {
	Name     string           `toml:"name"`
	Servers  []ServerConfig   `toml:"server"`
	Commands []CommandPackage `toml:"command_package"`
}

type Config struct {
	Projects []ProjectConfig `toml:"project"`
}

type ServerConfig struct {
	Name string `toml:"name"`
	Path string `toml:"path"`
	Port uint16 `toml:"port"`
}

func configPath() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(configDir, "SelfServer", "self_servers.toml"), nil
}

func LoadConfig() (*Config, error) {
	path, err := configPath()
	if err != nil {
		return nil, err
	}

	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return nil, err
	}

	if _, err := os.Stat(path); os.IsNotExist(err) {
		cfg := &Config{}

		if err := SaveConfig(cfg); err != nil {
			return nil, err
		}

		return cfg, nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var cfg Config

	if err := toml.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}

func SaveConfig(cfg *Config) error {
	path, err := configPath()
	if err != nil {
		return err
	}

	data, err := toml.Marshal(cfg)
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0600)
}
